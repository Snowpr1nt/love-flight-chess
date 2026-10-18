(function (root) {
  'use strict';

  // T 真心话 / D 大冒险 / R 奖励前进 / P 惩罚回退。
  // 顺序与棋盘顺时针路径一致，普通格依类别依次绑定 18 + 18 张卡。
  const pathCodes = 'T D T D R D T D T P D T D T R T D T D P T D T D R D T D T P D T D T R T D T D P D T D T'.split(' ');
  const codeToType = { T: 'truth', D: 'dare', R: 'reward', P: 'penalty' };
  const pathTypes = pathCodes.map((code) => codeToType[code]);
  let nextTruthId = 1;
  let nextDareId = 2;
  const tiles = pathTypes.map((type, index) => {
    const tile = { id: index + 1, type };
    if (type === 'truth') {
      tile.promptId = nextTruthId;
      nextTruthId += 2;
    } else if (type === 'dare') {
      tile.promptId = nextDareId;
      nextDareId += 2;
    }
    return tile;
  });

  const rewards = [
    { id: 1, title: '定制情话', text: '请对方围绕你选的主题，说一段只送给你的情话。' },
    { id: 2, title: '点播情歌', text: '请对方唱或哼一段你选的歌；不方便时可以说说这首歌让人想到什么。' },
    { id: 3, title: '一个小约定', text: '提出一个合理的小要求，双方愿意后约定完成方式和时间。' }
  ];

  const penalties = [
    { id: 1, title: '情歌演唱', text: '给对方唱一首情歌；不方便完整演唱时可协商改成哼唱一段。' },
    { id: 2, title: '云端奶茶', text: '约定请对方喝杯奶茶或点份小外卖；仅在双方愿意且方便时实际消费，也可改为推荐一款饮品。' },
    { id: 3, title: '昵称挑战', text: '接下来自己的 3 个回合，说话末尾带上“宝贝”；也可换成双方都喜欢的昵称。' }
  ];

  const finaleOptions = [
    { id: 1, title: '约定见面', text: '一起选一个双方都方便的见面时间或计划窗口。' },
    { id: 2, title: '实现一个愿望', text: '说出一个合理且双方愿意兑现的小愿望，并约定具体做法。' },
    { id: 3, title: '下一场云约会', text: '由获胜方挑选主题，约好下一次一起通话、观影或散步的时间。' }
  ];

  function validateBoardData() {
    const counts = pathTypes.reduce((result, type) => {
      result[type] = (result[type] || 0) + 1;
      return result;
    }, {});
    const promptIds = tiles.map((tile) => tile.promptId).filter(Number.isInteger).sort((a, b) => a - b);
    const expectedPromptIds = Array.from({ length: 36 }, (_, index) => index + 1);
    return {
      valid: pathTypes.length === 44 &&
        counts.truth === 18 && counts.dare === 18 && counts.reward === 4 && counts.penalty === 4 &&
        promptIds.every((id, index) => id === expectedPromptIds[index]),
      counts
    };
  }

  const boardData = {
    pathTypes,
    tiles,
    rewards,
    penalties,
    finaleOptions,
    // Both players launch from one shared pad into square 1.
    startPositions: { shared: 1, pink: 1, blue: 1 },
    validateBoardData
  };

  root.CoupleFlightBoardData = boardData;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = boardData;
  }
})(typeof window !== 'undefined' ? window : globalThis);
