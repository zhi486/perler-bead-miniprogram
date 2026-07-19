const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event) => {
  const { fileID } = event;
  try {
    const res = await cloud.downloadFile({ fileID });
    await cloud.openapi.security.imgSecCheck({
      media: { contentType: 'image/png', value: res.fileContent }
    });
    return { ok: true };
  } catch (err) {
    if (err.errCode === 87014) return { ok: false, reason: '图片含违规内容' };
    console.error('imgSecCheck error:', err);
    return { ok: false, reason: '检测失败', errCode: err.errCode };
  }
};
