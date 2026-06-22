import './header.css';
import logo from '../assets/RashAnalyzerlogo.png'

function Header() {
  return (
    <header className="site-header">
      <img src={logo} height="100px" width="100px" alt="RashAnalyzer logo" />
      <span id="rashanalyzer-title">RashAnalyzer</span>
    </header>
  )
}

export default Header