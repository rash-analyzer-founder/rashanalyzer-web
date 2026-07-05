import { Flask } from 'lucide-react';
import './header.css';

function Header() {
  return (
    <header className="site-header">
      <Flask className="header-logo" aria-label="RashAnalyzer logo" role="img" />
      <span id="rashanalyzer-title">RashAnalyzer</span>
    </header>
  )
}

export default Header