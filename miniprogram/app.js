App({
  onLaunch() {
    wx.cloud.init({ env: 'bead-prod-d1gca90yhba36c4b1' });
    const sys = wx.getSystemInfoSync();
    this.globalData.systemInfo = sys;
    this.globalData.pixelRatio = sys.pixelRatio;
  },
  globalData: {
    systemInfo: null,
    pixelRatio: 1
  }
});
