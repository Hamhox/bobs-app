#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const EXPECTED_ACTIONS = ["menu", "up", "left", "center", "right", "down", "back", "enter"];
const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const appDirectory = path.resolve(toolDirectory, "..");
const manifestPath = path.join(appDirectory, "data", "voyager-states.json");

async function gifDimensions(filename) {
  const bytes = await readFile(filename);
  const signature = bytes.subarray(0, 6).toString("ascii");
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    throw new Error(`${filename} is not a GIF`);
  }
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

function collectReachable(states, initialState, includeArchiveLinks = false) {
  const visited = new Set();
  const queue = [initialState];

  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    const state = states[id];
    if (!state) throw new Error(`Reachability encountered missing state ${id}`);
    visited.add(id);
    for (const target of Object.values(state.transitions)) {
      if (target && !visited.has(target)) queue.push(target);
    }
    if (state.autoTransition?.target && !visited.has(state.autoTransition.target)) {
      queue.push(state.autoTransition.target);
    }
    if (includeArchiveLinks) {
      for (const target of state.archiveLinks) {
        if (!visited.has(target)) queue.push(target);
      }
    }
  }

  return visited;
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const states = manifest.states;
  const ids = Object.keys(states);
  const screens = new Set();
  let noOps = 0;
  let autoTransitions = 0;
  let activeAutoTransitions = 0;

  if (ids.length !== 146) throw new Error(`Expected 146 states, found ${ids.length}`);
  if (manifest.initialState !== "index") throw new Error("Initial state must be index");

  for (const [id, state] of Object.entries(states)) {
    if (state.id !== id) throw new Error(`State key ${id} does not match record id ${state.id}`);
    const actions = Object.keys(state.transitions);
    if (actions.join("|") !== EXPECTED_ACTIONS.join("|")) {
      throw new Error(`${id} has an unexpected action set`);
    }

    for (const [action, target] of Object.entries(state.transitions)) {
      if (target === null) noOps += 1;
      else if (!states[target]) throw new Error(`${id}.${action} points to missing state ${target}`);
    }
    if (state.autoTransition) {
      autoTransitions += 1;
      if (state.autoTransition.active) activeAutoTransitions += 1;
      if (!states[state.autoTransition.target]) {
        throw new Error(`${id} auto-transitions to missing state ${state.autoTransition.target}`);
      }
    }
    for (const target of state.archiveLinks) {
      if (!states[target]) throw new Error(`${id} archive link points to missing state ${target}`);
    }

    const screenPath = path.join(appDirectory, ...state.screen.split("/"));
    const screenInfo = await stat(screenPath).catch(() => null);
    if (!screenInfo?.isFile()) throw new Error(`${id} is missing ${state.screen}`);
    const dimensions = await gifDimensions(screenPath);
    if (dimensions.width !== 504 || dimensions.height !== 303) {
      throw new Error(`${state.screen} is ${dimensions.width}x${dimensions.height}`);
    }
    screens.add(state.screen);
  }

  const actionReachable = collectReachable(states, manifest.initialState);
  const archiveReachable = collectReachable(states, manifest.initialState, true);
  const report = {
    states: ids.length,
    screens: screens.size,
    noOps,
    autoTransitions,
    activeAutoTransitions,
    actionReachableStates: actionReachable.size,
    archiveReachableStates: archiveReachable.size,
  };

  const expected = {
    states: 146,
    screens: 146,
    noOps: 330,
    autoTransitions: 15,
    activeAutoTransitions: 14,
    actionReachableStates: 145,
    archiveReachableStates: 146,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (report[key] !== value) {
      throw new Error(`${key}: received ${report[key]}, expected ${value}`);
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
