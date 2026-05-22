// Ambient declarations:
// - @kavicki/swi-design-system: DS ships raw TS source, typing as `any` to avoid
//   typechecking its internals. Remove when DS publishes dist + types.
// - react-native: aliased to react-native-web at runtime; rn-web has no types.
declare module '@kavicki/swi-design-system'
declare module '@kavicki/swi-design-system/*'
declare module 'react-native'
declare module 'react-native/*'
