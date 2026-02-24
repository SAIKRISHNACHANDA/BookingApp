const crypto = require('crypto');

/**
 * Generate PayU hash for payment request
 * @param {Object} params - The payment details
 * @returns {String} The computed hash
 */
exports.generateHash = (params) => {
    const {
        key,
        txnid,
        amount,
        productinfo,
        firstname,
        email,
        udf1 = '',
        udf2 = '',
        udf3 = '',
        udf4 = '',
        udf5 = '',
        salt
    } = params;

    const str = `${key}|${txnid}|${amount}|${productinfo}|${firstname}|${email}|${udf1}|${udf2}|${udf3}|${udf4}|${udf5}||||||${salt}`;
    return crypto.createHash('sha512').update(str).digest('hex');
};

/**
 * Verify PayU response hash
 * @param {Object} params - The response parameters
 * @param {String} salt - The merchant salt
 * @returns {Boolean} True if hash matches
 */
exports.verifyResponseHash = (params, salt) => {
    const {
        key,
        txnid,
        amount,
        productinfo,
        firstname,
        email,
        status,
        udf1 = '',
        udf2 = '',
        udf3 = '',
        udf4 = '',
        udf5 = '',
        hash
    } = params;

    const str = `${salt}|${status}||||||${udf5}|${udf4}|${udf3}|${udf2}|${udf1}|${email}|${firstname}|${productinfo}|${amount}|${txnid}|${key}`;
    const calculatedHash = crypto.createHash('sha512').update(str).digest('hex');

    return calculatedHash === hash;
};
