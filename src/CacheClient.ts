import * as redis from "ioredis";
import { ApiError } from "./ApiError";

//import { ErrorResponse } from

export enum EvictionPolicy {
  OldestFirst = "OldestFirst",
  NewestFirst = "NewestFirst",
  Reject = "Reject",
}

export interface CacheConfig {
  host: string;
  port: number;
  numberOfSlots?: number;
  ttlSeconds?: number;
  evictionPolicy?: EvictionPolicy;
}

const KEY_QUEUE = "trackKeyList";

class CacheClient {
  public redisClient?: redis.Redis;
  ttlSeconds?: number;
  numberOfSlots?: number;
  evictionPolicy?: EvictionPolicy;

  //"tracking_total_keys:"
  private getRedisKeyCount = async () => {
    if (this.redisClient === undefined) {
      throw new ApiError(
        "UninitializedClient",
        500,
        "Uninitialized Redis Client"
      );
    }
    const info = await this.redisClient.info("Keyspace");
    const infoVec = info.split("\n")[1].split(",");
    // Handling Edge case of initially is empty
    if (infoVec.length === 1) {
      return 0;
    }
    const keyStr = "db0:keys=";
    const keyString = infoVec.filter((s) => s.includes(keyStr))[0];
    
    const numberOfKeys = keyString.substring(keyStr.length);
    // Removing accounting for key list
    return parseInt(numberOfKeys) - 1;
  };

  private removeDroppedKeysFromQueue = async () => {
    if (this.redisClient === undefined) {
      throw new ApiError(
        "UninitializedClient",
        500,
        "Uninitialized Redis Client"
      );
    }
    // Batch through the tracking queue so we don't run out of memory
    const batchSize = 1000;
    for (let ii = 0; true; ii += batchSize) {
      const keyList = await this.redisClient.lrange(
        KEY_QUEUE,
        ii,
        ii + batchSize
      );
      if (keyList.length === 0) {
        return;
      }
      for (let jj = 0; jj < keyList.length; jj++) {
        if ((await this.redisClient.exists(keyList[jj])) === 0) {
          await this.redisClient.lpop(KEY_QUEUE);
          continue;
        }
        return;
      }
    }
  };

  public async setup(cacheConfig: CacheConfig) {
    this.ttlSeconds = cacheConfig.ttlSeconds ?? 3600;
    this.numberOfSlots = cacheConfig.numberOfSlots ?? 10000;
    this.evictionPolicy = cacheConfig.evictionPolicy ?? EvictionPolicy.Reject;
    this.redisClient = new redis.default({
      host: cacheConfig.host,
      port: cacheConfig.port,
    });
  }

  public async get(key: string) {
    if (this.redisClient === undefined) {
      throw Error("Uninitialized redis client");
    }
    const nullOrVal = await this.redisClient.get(key);
    if (nullOrVal == null) {
      throw new ApiError("ObjectNotFound", 404, "Object not found or expired");
    }
    return nullOrVal;
  }

  public async put(key: string, body: object, ttl?: number) {
    if (this.redisClient === undefined) {
      throw new ApiError(
        "UninitializedClient",
        500,
        "Uninitialized Redis Client"
      );
    }

    // Check if redis has space if does push, else go onto
    const numKeys = await this.getRedisKeyCount();
    if (numKeys >= (this.numberOfSlots ?? 10000)) {
      if (this.evictionPolicy === EvictionPolicy.OldestFirst) {
        //Remove TLS dropped items
        this.removeDroppedKeysFromQueue();
        const oldestKey = await this.redisClient.lpop(KEY_QUEUE);
        this.redisClient.del(oldestKey);
      } else if (this.evictionPolicy === EvictionPolicy.NewestFirst) {
        //Remove TLS dropped items, not essential for newest first
        //but will free up memory
        this.removeDroppedKeysFromQueue();
        const newestKey = await this.redisClient.rpop(KEY_QUEUE);
        this.redisClient.del(newestKey);
      } else if (this.evictionPolicy === EvictionPolicy.Reject) {
        throw new ApiError("NoStorageSpace", 507, "Object out of storage");
      }
    }
    const itemTtl = ttl ?? this.ttlSeconds ?? 3600;
    if (itemTtl) {
      this.redisClient.setex(key, itemTtl, JSON.stringify(body));
    } else {
      this.redisClient.set(key, JSON.stringify(body));
    }

    this.redisClient.rpush(KEY_QUEUE, key);
    return { key: key, value: body };
  }

  public async delete(key: string) {
    if (this.redisClient === undefined) {
      throw new ApiError(
        "UninitializedClient",
        500,
        "Uninitialized Redis Client"
      );
    }

    const ret = await this.redisClient.del(key);
    if (ret === 0) {
      throw new ApiError("ObjectNotFound", 404, "Object not found or expired");
    }
    return key;
  }
}

export default new CacheClient();
