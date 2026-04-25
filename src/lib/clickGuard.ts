// Shared timestamp guard to suppress iOS "ghost clicks" that fire on elements
// underneath a tap target after the original element disappears (e.g. a closing
// dropdown). Components that handle a tap call markPickJustHappened(); other
// elements that should ignore a follow-up click within the window check
// wasPickJustNow() and bail out.

let lastPickAt = 0;

export const markPickJustHappened = () => {
  lastPickAt = Date.now();
};

export const wasPickJustNow = (windowMs = 500) => {
  return Date.now() - lastPickAt < windowMs;
};
