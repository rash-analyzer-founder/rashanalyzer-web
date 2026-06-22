import { useState, useEffect } from 'react';
import './calculator.css';

function Calculator() {
  const [display, setDisplay] = useState('');
  const [calcvar, setCalcvar] = useState('');

  const shouldUseLaTeX = (text) => {
    const complexPatterns = /(\^|\√|√\(|!|sin|cos|tan|ln|π|e(?!\d))/;
    return complexPatterns.test(text);
  };

  const renderDisplay = (text) => {
    // For now, just display normally
  };

  const handleKeyDown = (e) => {
    let key = e.key;
    const allowed = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
                     '+', '-', '/', '*', '.', '^', '(', ')', 'Backspace', 'Enter'];

    if (!allowed.includes(key)) {
      e.preventDefault();
    }

    if (key === 'Enter') {
      e.preventDefault();
      calculate();
    }
  };

  const handleChange = (e) => {
    setDisplay(e.target.value);
    setCalcvar(e.target.value.replace(/\^/g, '**'));
    renderDisplay(e.target.value);
  };

  const factorial = (n) => {
    if (Number.isInteger(n) && n >= 0) {
      if (n === 0 || n === 1) return 1;
      let result = 1;
      for (let i = 2; i <= n; i++) {
        result *= i;
      }
      return result;
    } else {
      return gamma(n + 1);
    }
  };

  const gamma = (z) => {
    const g = 7;
    const p = [0.99999999999980993, 676.5203681218851, -1259.1392167224028,
               771.32342877765313, -176.61502916214059, 12.507343278686905,
               -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) {
      return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    }
    z -= 1;
    let x = p[0];
    for (let i = 1; i < g + 2; i++) {
      x += p[i] / (z + i);
    }
    let t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
  };

  const appendToDisplay = (input) => {
    setDisplay(prev => prev + input);
    let newCalcvar = calcvar;
    if (input === "π") {
      newCalcvar += "Math.PI";
    } else if (input === "e") {
      newCalcvar += "Math.E";
    } else if (input === "sin(") {
      newCalcvar += "Math.sin(";
    } else if (input === "cos(") {
      newCalcvar += "Math.cos(";
    } else if (input === "tan(") {
      newCalcvar += "Math.tan(";
    } else if (input === "^") {
      newCalcvar += "**";
    } else if (input === "√(") {
      newCalcvar += "Math.sqrt(";
    } else if (input === "ln(") {
      newCalcvar += "Math.log(";
    } else if (input === "!") {
      newCalcvar += "!";
    } else {
      newCalcvar += input;
    }
    setCalcvar(newCalcvar);
    renderDisplay(display + input);
  };

  const clearDisplay = () => {
    setDisplay('');
    setCalcvar('');
  };

  const deleteLast = () => {
    let newDisplay = display;
    let newCalcvar = calcvar;
    if (newCalcvar.endsWith("Math.PI")) {
      newDisplay = newDisplay.slice(0, -1);
      newCalcvar = newCalcvar.slice(0, -7);
    } else if (newCalcvar.endsWith("Math.E")) {
      newDisplay = newDisplay.slice(0, -1);
      newCalcvar = newCalcvar.slice(0, -6);
    } else if (newCalcvar.endsWith("Math.sin(")) {
      newDisplay = newDisplay.slice(0, -1);
      newCalcvar = newCalcvar.slice(0, -8);
    } else if (newCalcvar.endsWith("Math.cos(")) {
      newDisplay = newDisplay.slice(0, -1);
      newCalcvar = newCalcvar.slice(0, -8);
    } else if (newCalcvar.endsWith("Math.tan(")) {
      newDisplay = newDisplay.slice(0, -1);
      newCalcvar = newCalcvar.slice(0, -8);
    } else if (newCalcvar.endsWith("Math.sqrt(")) {
      newDisplay = newDisplay.slice(0, -1);
      newCalcvar = newCalcvar.slice(0, -8);
    } else if (newCalcvar.endsWith("Math.log(")) {
      newDisplay = newDisplay.slice(0, -1);
      newCalcvar = newCalcvar.slice(0, -8);
    } else {
      newDisplay = newDisplay.slice(0, -1);
      newCalcvar = newCalcvar.slice(0, -1);
    }
    setDisplay(newDisplay);
    setCalcvar(newCalcvar);
    renderDisplay(newDisplay);
  };

  const calculate = () => {
    try {
      if (calcvar.endsWith("!")) {
        let numStr = calcvar.slice(0, -1);
        let num = parseFloat(numStr);
        if (isNaN(num)) {
          setDisplay("Error");
        } else {
          let result = factorial(num);
          if (isNaN(result) || !isFinite(result)) {
            setDisplay("Error");
          } else {
            setDisplay(result.toString());
          }
        }
      } else {
        setDisplay(eval(calcvar).toString());
      }
    } catch (error) {
      setDisplay("Error");
      setCalcvar("");
    }
    renderDisplay(display);
  };

  return (
    <div className="calculator-body">
      <input
        type="text"
        id="display"
        placeholder="0"
        value={display}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      <div className="buttons">
        <button onClick={() => appendToDisplay('sin(')} className="trig">sin</button>
        <button onClick={() => appendToDisplay('cos(')} className="trig">cos</button>
        <button onClick={() => appendToDisplay('tan(')} className="trig">tan</button>
        <button onClick={() => appendToDisplay('(')} className="bracket">(</button>
        <button onClick={() => appendToDisplay(')')} className="bracket">)</button>

        <button onClick={() => appendToDisplay('^')} className="specialoperator">^</button>
        <button onClick={() => appendToDisplay('√(')} className="specialoperator">√</button>
        <button onClick={() => appendToDisplay('!')} className="specialoperator">!</button>
        <button onClick={() => appendToDisplay('ln(')} className="specialoperator">ln</button>
        <button onClick={clearDisplay} className="clearordelete">C</button>
        <button onClick={deleteLast} className="clearordelete">DEL</button>
        <button onClick={() => appendToDisplay('π')} className="special-num">π</button>
        <button onClick={() => appendToDisplay('e')} className="special-num">e</button>
        <button onClick={() => appendToDisplay('7')}>7</button>
        <button onClick={() => appendToDisplay('8')}>8</button>
        <button onClick={() => appendToDisplay('9')}>9</button>
        <button onClick={() => appendToDisplay('+')} className="operator-btn">+</button>

        <button onClick={() => appendToDisplay('4')}>4</button>
        <button onClick={() => appendToDisplay('5')}>5</button>
        <button onClick={() => appendToDisplay('6')}>6</button>
        <button onClick={() => appendToDisplay('-')} className="operator-btn">-</button>

        <button onClick={() => appendToDisplay('1')}>1</button>
        <button onClick={() => appendToDisplay('2')}>2</button>
        <button onClick={() => appendToDisplay('3')}>3</button>
        <button onClick={() => appendToDisplay('*')} className="operator-btn">×</button>

        <button onClick={() => appendToDisplay('0')} className="zero-btn">0</button>
        <button onClick={() => appendToDisplay('.')}>.</button>
        <button onClick={calculate} id="equal-btn">=</button>
        <button onClick={() => appendToDisplay('/')} className="operator-btn">/</button>
      </div>
    </div>
  );
}

export default Calculator;