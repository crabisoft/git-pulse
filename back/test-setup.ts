/**
 * The decorator metadata polyfill, which Nest itself loads at boot.
 *
 * The suites here run without that boot — they exercise pure engines and,
 * for the DTOs, the validation decorators directly. Loaded once for every
 * suite rather than by whichever module happens to pull `@nestjs/common` in:
 * that made a spec's fate depend on another file's import list.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';

/**
 * The narration, silenced.
 *
 * The version readings describe every address they try at `debug`, which is
 * what `LOG_LEVEL=debug` is for in a running API and pure noise in a suite that
 * asserts on the values instead. Warnings and errors stay: a suite printing one
 * is saying something.
 */
Logger.overrideLogger(['warn', 'error']);
