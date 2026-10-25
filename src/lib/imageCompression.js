import imageCompression from 'browser-image-compression';

/**
 * Compress a single image file
 * @param {File} file - The image file to compress
 * @param {Object} options - Compression options
 * @returns {Promise<File>} - Compressed image file
 */
export const compressImage = async (file, options = {}) => {
  const defaultOptions = {
    maxSizeMB: 1, // Max file size in MB
    maxWidthOrHeight: 1920, // Max dimension (maintains aspect ratio)
    useWebWorker: false,
    ...options,
  };

  try {
    const compressedFile = await imageCompression(file, defaultOptions);
    console.log(`Original: ${(file.size / 1024 / 1024).toFixed(2)}MB → Compressed: ${(compressedFile.size / 1024 / 1024).toFixed(2)}MB`);
    return compressedFile;
  } catch (error) {
    console.error('Compression failed:', error);
    return file; // Return original if compression fails
  }
};

/**
 * Compress multiple images
 * @param {File[]} files - Array of image files
 * @param {Object} options - Compression options
 * @returns {Promise<File[]>} - Array of compressed files
 */
export const compressMultipleImages = async (files, options = {}) => {
  return Promise.all(files.map(file => compressImage(file, options)));
};

/**
 * React Hook for image compression
 */
export const useImageCompression = () => {
  const handleImageUpload = async (event, callback) => {
    const files = Array.from(event.target.files);
    
    try {
      const compressedFiles = await compressMultipleImages(files);
      callback(compressedFiles);
    } catch (error) {
      console.error('Upload failed:', error);
    }
  };

  return { handleImageUpload };
};
