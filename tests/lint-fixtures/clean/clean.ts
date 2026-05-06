// Fixture for T054 — clean import surface (must pass NFR-001 lint).
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const _schema = z.object({ id: z.string() });
export const _used = { fs, path, os, randomUUID, _schema };
