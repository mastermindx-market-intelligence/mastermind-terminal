import { redirect } from 'next/navigation';

/** Stable entry to the shared notebook UI; identity remains in the existing Thesis Objects API. */
export default function TradingLabEntry() {
  redirect('/trading-lab/index.html');
}
