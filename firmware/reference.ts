// Reference firmware (MakeCode TypeScript, works on V1 and V2).
// Flash via https://makecode.microbit.org — paste, Download, copy to MICROBIT drive.
// Sends raw readings only; all calibration/smoothing lives in the browser.
let seq = 0
basic.forever(function () {
    seq += 1
    serial.writeLine(
        "F1," + seq + "," +
        input.acceleration(Dimension.X) + "," +
        input.acceleration(Dimension.Y) + "," +
        (input.buttonIsPressed(Button.A) ? 1 : 0) + "," +
        (input.buttonIsPressed(Button.B) ? 1 : 0)
    )
    basic.pause(30)
})
