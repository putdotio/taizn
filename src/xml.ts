export const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export const setXmlAttribute = (tag: string, attribute: string, value: string) => {
  const escapedValue = escapeXml(value);
  const attributePattern = new RegExp(`\\b${attribute}="[^"]*"`);

  if (attributePattern.test(tag)) {
    return tag.replace(attributePattern, `${attribute}="${escapedValue}"`);
  }

  return tag.replace(/\/?>$/, ` ${attribute}="${escapedValue}"$&`);
};
