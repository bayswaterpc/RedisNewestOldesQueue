import * as redis from "ioredis";
import { ApiError } from "./ApiError";
import dotenv from "dotenv";

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
  public redisClient: redis.Redis;
  defaultTtlSeconds: number;
  numberOfSlots: number;
  evictionPolicy: EvictionPolicy;

  constructor(cacheConfig: CacheConfig) {
    this.defaultTtlSeconds = cacheConfig.ttlSeconds ?? 3600;
    this.numberOfSlots = cacheConfig.numberOfSlots ?? 10000;
    this.evictionPolicy = cacheConfig.evictionPolicy ?? EvictionPolicy.Reject;
    this.redisClient = new redis.default({
      host: cacheConfig.host,
      port: cacheConfig.port,
    });
  }

  private getRedisKeyCount = async () => {
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

  private removeDroppedKeysFromQueueLHS = async () => {
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

  // Removes keys on the right side of queue which may have been deleted, or ttl dropped
  //
  private removeDroppedKeysFromQueueRHS = async () => {
    // Batch through the tracking queue so we don't run out of memory
    const batchSize = 1000;
    let keyList = await this.redisClient.lrange(KEY_QUEUE, -batchSize, -1);
    while (keyList.length) {
      for (let jj = keyList.length - 1; jj >= 0; jj -= 1) {
        if ((await this.redisClient.exists(keyList[jj])) === 0) {
          await this.redisClient.rpop(KEY_QUEUE);
          continue;
        }
        return;
      }
      keyList = await this.redisClient.lrange(KEY_QUEUE, -batchSize, -1);
    }
  };

  public async setup(cacheConfig: CacheConfig) {
    this.defaultTtlSeconds = cacheConfig.ttlSeconds ?? 3600;
    this.numberOfSlots = cacheConfig.numberOfSlots ?? 10000;
    this.evictionPolicy = cacheConfig.evictionPolicy ?? EvictionPolicy.Reject;
    this.redisClient = new redis.default({
      host: cacheConfig.host,
      port: cacheConfig.port,
    });
  }

  public async get(key: string) {
    const nullOrVal = await this.redisClient.get(key);
    if (nullOrVal == null) {
      throw new ApiError("ObjectNotFound", 404, "Object not found or expired");
    }
    return nullOrVal;
  }

  public async put(key: string, body: object, ttl?: number) {
    // Check if redis has space if does push, else go onto
    const numKeys = await this.getRedisKeyCount();
    if (numKeys >= this.numberOfSlots) {
      if (this.evictionPolicy === EvictionPolicy.OldestFirst) {
        //Remove TLS dropped items
        await this.removeDroppedKeysFromQueueLHS();
        const oldestKey = await this.redisClient.lpop(KEY_QUEUE);
        this.redisClient.del(oldestKey);
      } else if (this.evictionPolicy === EvictionPolicy.NewestFirst) {
        //Remove TLS dropped items, 
        // LHS not essential for newest first but will free up memory
        await this.removeDroppedKeysFromQueueLHS();
        await this.removeDroppedKeysFromQueueRHS();
        const newestKey = await this.redisClient.rpop(KEY_QUEUE);
        this.redisClient.del(newestKey);
      } else if (this.evictionPolicy === EvictionPolicy.Reject) {
        throw new ApiError("NoStorageSpace", 507, "Object out of storage");
      }
    }
    const itemTtl = ttl ?? this.defaultTtlSeconds;
    if (itemTtl) {
      this.redisClient.setex(key, itemTtl, JSON.stringify(body));
    } else {
      this.redisClient.set(key, JSON.stringify(body));
    }

    this.redisClient.rpush(KEY_QUEUE, key);
    return { key: key, value: body };
  }

  public async delete(key: string) {
    const ret = await this.redisClient.del(key);
    if (ret === 0) {
      throw new ApiError("ObjectNotFound", 404, "Object not found or expired");
    }
    await this.redisClient.lrem(KEY_QUEUE, 0, key);
    return key;
  }
}

dotenv.config();
const { HOST, CACHE_PORT, NUMBER_OF_SLOTS, TTL_SECONDS, EVICTION_POLICY } =
  process.env;

export default new CacheClient({
  host: HOST ?? "",
  port: parseInt(CACHE_PORT as string, 10),
  numberOfSlots: parseInt(NUMBER_OF_SLOTS as string, 10),
  ttlSeconds: parseInt(TTL_SECONDS as string, 10),
  evictionPolicy: <EvictionPolicy>EVICTION_POLICY,
});
