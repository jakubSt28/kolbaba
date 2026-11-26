/** mammoth ships no types; this is the one call the attachment viewer makes. */
declare module "mammoth/mammoth.browser.min.js" {
  const mammoth: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>;
  };
  export default mammoth;
}
