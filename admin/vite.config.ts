import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5178,
    // 管理端 dev 代理：/api 转发到后端
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7010',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 大依赖单独分包，避免主 chunk 过大（element-plus / echarts 全量包属预期）
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          echarts: ['echarts'],
          elementPlus: ['element-plus', '@element-plus/icons-vue'],
        },
      },
    },
  },
})
