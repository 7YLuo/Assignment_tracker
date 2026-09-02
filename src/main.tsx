import { createRoot } from 'react-dom/client';
import Page from '../app/page';
import '../app/styles.css';
import '../app/features.css';

createRoot(document.getElementById('root')!).render(<Page />);
