// What the Spotlight's clip previews need to play: the player SDK and hls.js,
// together ~1 MB of JavaScript. HomeHero imports this file on demand, so the
// home page draws its first screen (the slide's picture) without waiting for it;
// the clip fades in over the picture once this has loaded.
export { Player, ThreeSpeakApi } from "@mantequilla-soft/3speak-player";
export { withGatewayFallback } from "../../lib/hlsGatewayFallback.js";
