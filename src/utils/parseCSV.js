import Papa from 'papaparse';

const applyNoHeaders = (results) => {
    if (!results.data.length) return results;
    const numCols = results.data[0].length;
    const fields = Array.from({ length: numCols }, (_, i) => `col_${i}`);
    results.data = results.data.map(row =>
        Object.fromEntries(fields.map((k, i) => [k, row[i]]))
    );
    results.meta = { ...results.meta, fields };
    return results;
};

export const parseCSV = (file, { noHeaders = false } = {}) => {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: !noHeaders,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: (results) => resolve(noHeaders ? applyNoHeaders(results) : results),
            error: (error) => reject(error),
        });
    });
};

export const parseCSVText = (text, { noHeaders = false } = {}) => {
    return new Promise((resolve) => {
        Papa.parse(text, {
            header: !noHeaders,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: (results) => resolve(noHeaders ? applyNoHeaders(results) : results),
        });
    });
};
