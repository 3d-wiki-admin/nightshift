import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'nightshift-project',
  description: 'Scaffolded by nightshift project-bootstrap skill.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
