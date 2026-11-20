/**
 * The release this build is. The release workflow stamps `RECODER_VERSION` from the tag (an `ARG` in the
 * image's Dockerfile, a `--define` in the release binaries); anything built by hand falls back to the last
 * released number, which is only ever shown, never acted on without a release check.
 */
export const VERSION = process.env.RECODER_VERSION ?? '0.3.0';
