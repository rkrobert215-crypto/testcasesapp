import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

  return {
    server: {
      host: "::",
      port: 8080,
      proxy: supabaseUrl && supabaseKey
        ? {
            "/api/functions": {
              target: `${supabaseUrl}/functions/v1`,
              changeOrigin: true,
              proxyTimeout: 600_000,
              timeout: 600_000,
              rewrite: (path) => path.replace(/^\/api\/functions/, ""),
              configure: (proxy) => {
                proxy.on("proxyReq", (proxyReq) => {
                  proxyReq.setHeader("apikey", supabaseKey);
                  proxyReq.setHeader("Authorization", `Bearer ${supabaseKey}`);
                });
              },
            },
          }
        : undefined,
    },
    plugins: [react()],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
