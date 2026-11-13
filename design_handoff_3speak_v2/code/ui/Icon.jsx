// Material Symbols Rounded: the icon set every design file uses.
// Install: npm i material-symbols   then import "material-symbols/rounded.css" once (main.jsx).
// <Icon name="thumb_up" fill /> renders the same glyph as the mockups.
// Icon.of("thumb_up") returns a component you can pass to the primitives in ui.jsx:
// <Button icon={Icon.of("share")}>Share</Button>
export function Icon({ name, size = 20, fill = false, weight = 400, className = "", style, ...rest }) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-rounded ${className}`}
      style={{ fontSize: size, lineHeight: 1, fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' 24`, ...style }}
      {...rest}
    >
      {name}
    </span>
  );
}
Icon.of = (name, opts = {}) => {
  const C = ({ size }) => <Icon name={name} size={size} {...opts} />;
  C.displayName = `Icon(${name})`;
  return C;
};
