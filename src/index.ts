#!/usr/bin/env node
import { loadConfig } from './config.js';

const config = loadConfig();
console.log(`Support Ops MCP Server starting...`);
console.log(`Transport: ${config.transport}`);
console.log(`ASD API: ${config.asdApiUrl}`);
// Server setup will go here in Milestone 1C
