/** Soft motion presets — use everywhere Framer Motion runs. */
export const easeSoft = [0.22, 1, 0.36, 1] as const;
export const easeSoftInOut = [0.45, 0.05, 0.25, 1] as const;

/** Gentle settle — panels, sheets, floating buttons */
export const softSpring = {
  type: "spring" as const,
  stiffness: 180,
  damping: 26,
  mass: 0.9,
};

/** Softer pop — chips, hearts, quick reactions */
export const softPop = {
  type: "spring" as const,
  stiffness: 220,
  damping: 22,
  mass: 0.85,
};

/** Short fade/slide without bounce */
export const softTween = {
  duration: 0.38,
  ease: easeSoft,
};

/** Page / route change */
export const softPage = {
  duration: 0.42,
  ease: easeSoft,
};

/** Reveal-on-scroll */
export const softReveal = {
  duration: 0.75,
  ease: easeSoft,
};
