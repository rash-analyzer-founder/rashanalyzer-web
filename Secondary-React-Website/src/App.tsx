import { useState, useEffect } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import heroImg from './assets/hero.png'


function App() {
  const [count, setCount] = useState(0)
  // Get the array from the server
  useEffect(() => {
    async function getPWDMs() {
      let serverdone = 1
      let pwdms = []
    try {while (serverdone != 1) {
        let pwdmRawdata = await fetch("http://localhost:3000/");
        let pwdm = pwdmRawdata.json();
        pwdms.push(pwdm);
      }
    } 
    catch(error) {
      console.log("System Error: Server didn't respond or you are not connected to the internet, or... the server exploded")
    }
    }
    getPWDMs()
   
  }, [])
  return (
    <>
  <div>
    <ul>
      {pwdms.map((pwdm, pwdmi) => <li key={pwdmi}>{pwdm.pwdminame}</li>)}
    </ul>
  </div>
    </>
  )
}

export default App
