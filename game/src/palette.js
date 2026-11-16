// IRONWORKS palette — dusk foundry. Six colours, used everywhere:
// canvas (deep blue-grey night), surface (gunmetal), hairline (dark steel),
// ink (warm off-white), muted (cool grey), accent (molten orange).
// The same six names exist as CSS custom properties in index.html.
export const PALETTE = {
  canvas: 0x14161a,
  surface: 0x1e2228,
  hairline: 0x2c323a,
  ink: 0xe9e6df,
  muted: 0x98a0a8,
  accent: 0xf07a1e,
  // derived scene colours (kept in the same family, never new hues)
  floor: 0x23262b,
  wall: 0x2a2e35,
  wallDark: 0x1b1e23,
  crate: 0x3a332a,
  crateDark: 0x2e2a24,
  steel: 0x4a515a,
  steelDark: 0x353b43,
  furnace: 0xff7a1a,
  ember: 0xf07a1e, // attackers "Ember" trim
  anvil: 0x5f8fd0, // defenders "Anvil" trim
  lamp: 0xffb45e,
  smoke: 0x8a8f94,
};

export const CSS = {
  canvas: '#14161a',
  surface: '#1e2228',
  hairline: '#2c323a',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f07a1e',
};
