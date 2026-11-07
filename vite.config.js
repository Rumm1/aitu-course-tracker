import {defineConfig} from 'vite';
export default defineConfig({base:process.env.BASE_PATH || './',define:{__PROJECT_REPOSITORY__:JSON.stringify(process.env.GITHUB_REPOSITORY||'Rumm1/aitu-course-tracker')},build:{target:'es2022'}});
