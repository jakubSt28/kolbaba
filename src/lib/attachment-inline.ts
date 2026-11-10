/** Types a browser may render inline; everything else downloads, so a hostile HTML/SVG attachment can't run on our origin. */
const INLINE = /^(image\/(png|jpe?g|gif|webp|avif|heic|heif)|application\/pdf|text\/plain)$/i;

/** The server serves anything else as a download, so a link must not open a window for it: that window would stay empty. */
export const opensInBrowser = (mime: string) => INLINE.test(mime);
