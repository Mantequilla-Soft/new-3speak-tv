import { PrivateKey } from "@hiveio/dhive";
import { Buffer } from "buffer";

export async function uploadImageToHive(file) {
  const postingKey = import.meta.env.VITE_HIVE_POSTING_KEY;
  const username = import.meta.env.VITE_HIVE_USER;

  if (!postingKey || !username) {
    throw new Error("Hive username or posting key missing in .env");
  }

  try {
    // Read as Uint8Array
    const arrayBuffer = await file.arrayBuffer();
    const imageBytes = new Uint8Array(arrayBuffer);

    // Challenge message
    const challenge = new TextEncoder().encode("ImageSigningChallenge");

    // Combine challenge + image
    const combined = new Uint8Array(challenge.length + imageBytes.length);
    combined.set(challenge);
    combined.set(imageBytes, challenge.length);

    // SHA-256 hash
    const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
    const hashed = new Uint8Array(hashBuffer);

    // Sign the hash
    const key = PrivateKey.fromString(postingKey);
    const signature = key.sign(Buffer.from(hashed)).toString();

    // Use FormData instead of raw bytes!
    const formData = new FormData();
    formData.append("file", file); // IMPORTANT: must be "file", not "image"

    const res = await fetch(`https://images.hive.blog/${username}/${signature}`, {
      method: "POST",
      body: formData,
    });

    const result = await res.json();

    if (result.url) {
      return result.url;
    } else {
      throw new Error("Unexpected response from Hive ImageHoster");
    }

  } catch (err) {
    console.error("Hive Upload Error:", err);
    throw err;
  }
}
