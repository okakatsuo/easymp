import {
  EASYMP_MOVIE_PORT,
  EasyMPMovie,
  EpsonProjector,
  ProjectorAudio,
  encodeEasyMPLength,
} from "easymp";

if (typeof EpsonProjector !== "function") {
  throw new Error("EpsonProjector is missing from the package exports");
}

if (typeof ProjectorAudio !== "function") {
  throw new Error("ProjectorAudio is missing from the package exports");
}

if (typeof EasyMPMovie !== "function") {
  throw new Error("EasyMPMovie is missing from the package exports");
}

if (EASYMP_MOVIE_PORT !== 50020) {
  throw new Error("Unexpected EasyMP movie port");
}

if (encodeEasyMPLength(128).toString("hex") !== "90808100") {
  throw new Error("The packaged EasyMP encoder returned an unexpected value");
}

console.log("Package import smoke test passed");
