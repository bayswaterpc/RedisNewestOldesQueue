import express, { Response as ExResponse, Request as ExRequest } from "express";
import bodyParser from "body-parser";
import { RegisterRoutes } from "../build/routes";
import CacheClient from "./CacheClient";
import { EvictionPolicy } from "./CacheClient";
import swaggerUi from "swagger-ui-express";
import dotenv from 'dotenv';
import './CacheController';

dotenv.config();

const { HOST, CACHE_PORT, NUMBER_OF_SLOTS, TTL_SECONDS, EVICTION_POLICY } =
  process.env;

export const app = express();

// Use body parser to read sent json payloads
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);
app.use(bodyParser.json());
app.use("/docs", swaggerUi.serve, async (_req: ExRequest, res: ExResponse) => {
  return res.send(
    swaggerUi.generateHTML(await import("../build/swagger.json"))
  );
});

console.log();
CacheClient.setup({
  host: HOST ?? "",
  port: parseInt(CACHE_PORT as string, 10),
  numberOfSlots: parseInt(NUMBER_OF_SLOTS as string, 10),
  ttlSeconds: parseInt(TTL_SECONDS as string, 10),
  evictionPolicy: <EvictionPolicy>EVICTION_POLICY,
});

RegisterRoutes(app);
