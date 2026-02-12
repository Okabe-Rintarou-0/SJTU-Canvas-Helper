package com.sjtu.canvas.helper.util

import android.graphics.Bitmap
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import com.google.zxing.common.BitMatrix

object QrCodeGenerator {

    fun generate(content: String, size: Int = 600): ImageBitmap {
        val matrix = MultiFormatWriter().encode(content, BarcodeFormat.QR_CODE, size, size)
        val bitmap = matrix.toBitmap()
        return bitmap.asImageBitmap()
    }

    private fun BitMatrix.toBitmap(): Bitmap {
        val width = width
        val height = height
        val pixels = IntArray(width * height)
        for (y in 0 until height) {
            val offset = y * width
            for (x in 0 until width) {
                pixels[offset + x] = if (get(x, y)) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
            }
        }
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
        return bitmap
    }
}
