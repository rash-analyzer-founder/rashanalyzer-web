const display = document.getElementById('display');
let calcvar = "";

function shouldUseLaTeX(text) {
    // Check if expression contains complex operations
    const complexPatterns = /(\^|\√|√\(|!|sin|cos|tan|ln|π|e(?!\d))/;
    return complexPatterns.test(text);
}

function renderDisplay(text) {
    // For now, just display normally
    // LaTeX rendering will be added later when needed
}
display.addEventListener('keydown', function(event) {
    let key = event.key; // The key the user pressed
    
    // List of allowed characters: numbers, operators, and special symbols
    const allowed = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 
                     '+', '-', '/', '*', '.', '^', '(', ')', 'Backspace', 'Enter'];
    
    // Check if the key is NOT in the allowed list
    if (!allowed.includes(key)) {
        event.preventDefault(); // BLOCK this keystroke
    }
    
    // Handle Enter key to calculate
    if (key === 'Enter') {
        event.preventDefault();
        calcvar = display.value.replace(/\^/g, '**');
        calculate();
    }
});

// Sync display input to calcvar when user types directly
display.addEventListener('input', function(event) {
    calcvar = display.value.replace(/\^/g, '**');
    renderDisplay(display.value);
});

function factorial(n) {
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
}

function gamma(z) {
    // Lanczos approximation for gamma function
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
}

function appendToDisplay(input) {
    display.value += input;
    if (input === "π") {
        calcvar += "Math.PI";
    } else if (input === "e") {
        calcvar += "Math.E";
    } else if (input === "sin(") {
        calcvar += "Math.sin(";
    } else if (input === "cos(") {
        calcvar += "Math.cos(";
    } else if (input === "tan(") {
        calcvar += "Math.tan(";
    } else if (input === "^") {
        calcvar += "**";
    } else if (input === "√(") {
        calcvar += "Math.sqrt(";
    } else if (input === "ln(") {
        calcvar += "Math.log(";
    } else if (input === "!") {
        calcvar += "!";
    } else {
        calcvar += input;
    }
    renderDisplay(display.value);
    // Hmm...
}

function clearDisplay() {
    display.value = "";
    calcvar = "";
    renderDisplay("");
}

function deleteLast() {
    if (calcvar.endsWith("Math.PI")) {
        display.value = display.value.slice(0, -1);
        calcvar = calcvar.slice(0, -7);
    } else if (calcvar.endsWith("Math.E")) {
        display.value = display.value.slice(0, -1);
        calcvar = calcvar.slice(0, -6);
    } else if (calcvar.endsWith("Math.sin(")) {
        display.value = display.value.slice(0, -1);
        calcvar = calcvar.slice(0, -8);
    } else if (calcvar.endsWith("Math.cos(")) {
        display.value = display.value.slice(0, -1);
        calcvar = calcvar.slice(0, -8);
    } else if (calcvar.endsWith("Math.tan(")) {
        display.value = display.value.slice(0, -1);
        calcvar = calcvar.slice(0, -8);
    } else if (calcvar.endsWith("Math.sqrt(")) {
        display.value = display.value.slice(0, -1);
        calcvar = calcvar.slice(0, -8);
    } else if (calcvar.endsWith("Math.log(")) {
        display.value = display.value.slice(0, -1);
        calcvar = calcvar.slice(0, -8);
    } else {
        display.value = display.value.slice(0, -1);
        calcvar = calcvar.slice(0, -1);
    }
    renderDisplay(display.value);
}

function calculate() {
    try {
        if (calcvar.endsWith("!")) {
            let numStr = calcvar.slice(0, -1);
            let num = parseFloat(numStr);
            if (isNaN(num)) {
                display.value = "Error";
            } else {
                let result = factorial(num);
                if (isNaN(result) || !isFinite(result)) {
                    display.value = "Error";
                } else {
                    display.value = result;
                }
            }
        } else {
            display.value = eval(calcvar);
        }
    } catch (error) {
        display.value = "Error";
        calcvar = "";
    }
    renderDisplay(display.value);
}