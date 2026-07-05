import { useState, useRef, useEffect } from 'react'

function App() {
  const [count, setCount] = useState(0)
  const elementRef = useRef(null)

  useEffect(() => {
    const handleClick = () => setCount((prev) => prev + 1)

    const el = elementRef.current
    if (el) {
      el.addEventListener('click', handleClick)
    }

    return () => {
      if (el) {
        el.removeEventListener('click', handleClick)
      }
    }
  }, [])

  return (
    <>
      <h1 id="Cluss">Header.</h1>
      <p ref={elementRef}>Click this! {count}</p>
    </>
  )
}

export default App