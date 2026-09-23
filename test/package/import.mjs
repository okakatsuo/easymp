import { EpsonProjector, encodeEasyMPLength } from "easymp";

if (typeof EpsonProjector !== "function") {
  throw new Error("EpsonProjector is missing from the package exports");
}

if (encodeEasyMPLength(128).toString("hex") !== "90808100") {
  throw new Error("The packaged EasyMP encoder returned an unexpected value");
}

console.log("Package import smoke test passed");
