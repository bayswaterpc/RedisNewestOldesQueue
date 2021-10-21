import { Request as ExpressRequest } from "express";
import {
  Body,
  Path,
  Post,
  Controller,
  Route,
  Response,
  SuccessResponse,
  Delete,
  Query,
  Get,
} from "tsoa";
import { ApiError } from "./ApiError";
import CacheClient from "./CacheClient";

export interface CacheInput {
  value: any;
}

@Route("/cache")
export class CacheController extends Controller {
  @SuccessResponse(200, "Object was found and not expired")
  @Get("/object/{key}")
  @Response<ApiError>(404, "Object not found or expired")
  /**
   * Create key-value in Cache
   */
  public async getObject(@Path() key: string): Promise<string> {
    const value = await CacheClient.get(key);
    if (!value) {
      throw new ApiError("ObjectNotFound", 404, "Object not found or expired");
    }
    return value;
  }

  @SuccessResponse(200, "Object Stored")
  @Post("/object/{key}")
  @Response<ApiError>(507, "Object out of storage")
  /**
   * Create key-value in Cache
   */
  public async putObject(
    @Path() key: string,
    @Body() input: CacheInput,
    @Query() ttl?: number
  ): Promise<any> {
    return await CacheClient.put(key, input.value, ttl);
  }

  @SuccessResponse(200, "Object Removed")
  @Delete("/object/{key}/delete")
  @Response<ApiError>(404, "Object not found or expired")
  /**
   * Create key-value in Cache
   */
  public async deleteObject(@Path() key: any): Promise<string> {
    return await CacheClient.delete(key);
  }
}
