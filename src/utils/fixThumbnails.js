import { Buffer } from "buffer";
import bs58 from "bs58";

const APP_BUNNY_IPFS_CDN = "https://ipfs-3speak.b-cdn.net";
const APP_IMAGE_CDN_DOMAIN = "https://media.3speak.tv";

// export function fixVideoThumbnail(video) {
//   let baseUrl = "";
//   let thumbUrl = "";

//   // 🧠 Check if IPFS
//   if (video.images?.thumbnail?.includes("ipfs://")) {
//     baseUrl = `${APP_BUNNY_IPFS_CDN}/ipfs/${video.images?.thumbnail.replace("ipfs://", "")}/`;
//   } else if (video.images?.thumbnail?.includes(APP_IMAGE_CDN_DOMAIN)) {
//     // 🧠 Convert old thumbnail to Hive image proxy
//     const encoded = bs58.encode(Buffer.from(video.images?.thumbnail));
//     thumbUrl = `https://images.hive.blog/p/${encoded}?format=jpeg&mode=cover&width=340&height=191`;
//     baseUrl = video.images?.thumbnail;
//   } else {
//     baseUrl = video.images?.thumbnail || "";
//   }
//   console.log(thumbUrl)
//   return thumbUrl || baseUrl;
// }

export function fixVideoThumbnail(video) {
  let thumbUrl = "";

  const thumbnail = video?.images?.thumbnail || video?.thumbUrl || video?.spkvideo?.thumbnail_url;

  // 🚧 If no thumbnail, return a fallback image
  if (!thumbnail) {
    return "https://media.3speak.tv/defaults/default_thumbnail.png";
  }
  // 🧠 Convert old thumbnail to Hive image proxy
    const encoded = bs58.encode(Buffer.from(thumbnail));
    thumbUrl = `https://images.hive.blog/p/${encoded}?format=jpeg&mode=cover&width=340&height=191`;

  // console.log(thumbUrl)
  return thumbUrl;
}
