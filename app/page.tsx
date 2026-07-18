import { App } from '@/components/App';
import { AppProviders } from '@/components/providers/AppProviders';

export default function Page() {
  return (
    <AppProviders>
      <App />
    </AppProviders>
  );
}
