import { defineConfig } from "prisma/config";
import * as dotenv from "dotenv";

dotenv.config({ path: './apps/server/.env' });

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: (process.env.DIRECT_URL ?? process.env.DATABASE_URL)!,
  },
});
