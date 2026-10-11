import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The examples import the package by name, as a project using it would
    alias: {
      "@sp11/rest-client": fileURLToPath(new URL("./index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node",
  },
});
