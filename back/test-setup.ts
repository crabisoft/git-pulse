/**
 * The decorator metadata polyfill, which Nest itself loads at boot.
 *
 * The suites here run without that boot — they exercise pure engines and,
 * for the DTOs, the validation decorators directly. Loaded once for every
 * suite rather than by whichever module happens to pull `@nestjs/common` in:
 * that made a spec's fate depend on another file's import list.
 */
import 'reflect-metadata';
