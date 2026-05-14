// Augment react-native types with react-native-web-only props the admin
// app uses. @types/react-native upstream omits these because they are
// non-portable web extensions, but rn-web supports them and we rely on
// them for the FidelityReview audit overlay.
import 'react-native';

declare module 'react-native' {
  interface ViewProps {
    /** rn-web extension. Serialises to HTML data-* attributes. */
    dataSet?: Record<string, string | number | boolean | undefined>;
  }
}
