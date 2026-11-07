import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',
  testMatch:['browser.spec.mjs','extension-browser.spec.mjs','excel-browser.spec.mjs'],
  timeout:30000,
  fullyParallel:false,
  workers:1,
  reporter:'list',
  use:{baseURL:'http://127.0.0.1:5178/aitu-course-tracker/',channel:'chrome',headless:true,viewport:{width:1440,height:1000}},
  webServer:{command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5178 --strictPort --base /aitu-course-tracker/',url:'http://127.0.0.1:5178/aitu-course-tracker/',reuseExistingServer:!process.env.CI,timeout:30000}
});
