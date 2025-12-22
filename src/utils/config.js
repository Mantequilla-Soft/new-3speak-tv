
const API_URL_FROM_WEST = import.meta.env.VITE_API_URL_FROM_WEST || 'https://views.3speak.tv'; 
const GRAPHQL_API_URL = import.meta.env.VITE_GRAPHQL_API_URL; 
const VIDEO_CDN_DOMAIN = import.meta.env.VITE_APP_VIDEO_CDN_DOMAIN; 
const HIVE_HOST_API = "https://api.hive.blog/"; // Constant, no need for env variable
const UPLOAD_TOKEN = import.meta.env.VITE_UPLOAD_TOKEN; 
const UPLOAD_URL= import.meta.env.VITE_UPLOAD_URL; 

export { API_URL_FROM_WEST, GRAPHQL_API_URL, VIDEO_CDN_DOMAIN, HIVE_HOST_API, UPLOAD_TOKEN, UPLOAD_URL};
