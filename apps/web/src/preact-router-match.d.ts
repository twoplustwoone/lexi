import 'preact-router/match';

declare module 'preact-router/match' {
  interface LinkProps {
    href?: string;
  }
}
