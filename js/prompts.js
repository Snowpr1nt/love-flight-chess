(function (root) {
  'use strict';

  // 36 张互动卡：18 张真心话、18 张大冒险。按类别交替编号，供图鉴和路径引用。
  const prompts = [
    { id: 1, type: 'truth', stage: '破冰', shortTitle: '初见细节', title: '隔着屏幕的初见', text: '第一次隔着屏幕聊天或见面时，对方哪个小细节让你记到了现在？' },
    { id: 2, type: 'dare', stage: '破冰', shortTitle: '三句喜欢', title: '三句具体的喜欢', text: '对着语音或视频，说出对方今天三个具体的可爱之处；也可以打字发给对方。' },
    { id: 3, type: 'truth', stage: '破冰', shortTitle: '心动消息', title: '消息亮起时', text: '最近哪一条来自对方的消息，让你看到时偷偷笑了？' },
    { id: 4, type: 'dare', stage: '破冰', shortTitle: '今日昵称', title: '今日专属昵称', text: '给对方取一个只在今天使用的昵称，并用这个昵称说一句晚安。' },
    { id: 5, type: 'truth', stage: '破冰', shortTitle: '远程照顾', title: '远程被照顾', text: '我们不在同一座城市时，对方做过哪件小事，让你觉得被照顾？' },
    { id: 6, type: 'dare', stage: '破冰', shortTitle: '屏幕碰拳', title: '屏幕碰拳', text: '两人倒数三秒，对着屏幕一起做个碰拳或比心动作；仅用语音时可说出同一句口令。' },
    { id: 7, type: 'truth', stage: '破冰', shortTitle: '想你的歌', title: '想起你的声音', text: '哪首歌、哪种声音或哪个时间点，最容易让你想起对方？' },
    { id: 8, type: 'dare', stage: '破冰', shortTitle: '重逢开场', title: '重逢开场白', text: '用十秒演一段下次见面时你想说的开场白；不方便表演就念出来。' },
    { id: 9, type: 'truth', stage: '破冰', shortTitle: '补上夸奖', title: '未发送的夸奖', text: '最近有什么想夸对方、却还没有发出去的话？现在可以说出来。' },
    { id: 10, type: 'dare', stage: '破冰', shortTitle: '哼歌给你', title: '哼给你听', text: '轻哼一小段想到对方时会想起的歌，或说出歌名和它与你们的关联。' },
    { id: 11, type: 'truth', stage: '破冰', shortTitle: '重播通话', title: '最想重播的一刻', text: '我们哪一次普通的通话或聊天，你最想再经历一遍？' },
    { id: 12, type: 'dare', stage: '破冰', shortTitle: '表情故事', title: '表情包小故事', text: '用三个表情符号讲一个今天想分享给对方的小故事，再解释你的选择。' },
    { id: 13, type: 'truth', stage: '靠近', shortTitle: '疲惫陪伴', title: '疲惫时的陪伴', text: '你疲惫时，希望远方的我怎样陪你？一句话、一通电话，还是安静听你说？' },
    { id: 14, type: 'dare', stage: '靠近', shortTitle: '今日分享', title: '今日高光', text: '轮流补完：“今天最想和你分享的一件小事是……”' },
    { id: 15, type: 'truth', stage: '靠近', shortTitle: '舒服联系', title: '最舒服的联系', text: '我们现在的联系里，哪一种方式最让你有被陪伴的感觉？' },
    { id: 16, type: 'dare', stage: '靠近', shortTitle: '空中画心', title: '空中画心', text: '在镜头前或空中画一个小图案，让对方猜；只用语音时可描述画法。' },
    { id: 17, type: 'truth', stage: '靠近', shortTitle: '云端计划', title: '下一次共同计划', text: '接下来一个月，最想和对方一起完成哪件可以远程进行的小事？' },
    { id: 18, type: 'dare', stage: '靠近', shortTitle: '回忆接龙', title: '回忆接龙', text: '你先说出一段共同回忆的开头，让对方接上结尾，再交换一次。' },
    { id: 19, type: 'truth', stage: '靠近', shortTitle: '化解误会', title: '理解我的方式', text: '当我们有误会时，你最希望我先做什么，才会感到被认真理解？' },
    { id: 20, type: 'dare', stage: '靠近', shortTitle: '夸夸颁奖', title: '二十秒颁奖词', text: '用颁奖词的语气夸对方二十秒，奖项名称由你来取。' },
    { id: 21, type: 'truth', stage: '靠近', shortTitle: '想你时刻', title: '想你的时刻', text: '这周哪一刻，你特别想让对方立刻出现在身边？' },
    { id: 22, type: 'dare', stage: '靠近', shortTitle: '专属暗号', title: '我们的暗号', text: '一起设计一句“我在想你”的专属暗号，并各用它说一次话。' },
    { id: 23, type: 'truth', stage: '靠近', shortTitle: '安心小事', title: '安心的小事', text: '异地相处中，对方做哪一件小事会让你特别安心？' },
    { id: 24, type: 'dare', stage: '靠近', shortTitle: '云约会', title: '云约会排期', text: '各提一个不花钱也能完成的云约会项目，拼成一次双方都方便的约会。' },
    { id: 25, type: 'truth', stage: '心动', shortTitle: '见面首站', title: '见面后的第一站', text: '下次见面时，除去赶路，你最想和对方先做什么？' },
    { id: 26, type: 'dare', stage: '心动', shortTitle: '三词心动', title: '三词心动卡', text: '用三个词为对方做一张口头心动小卡，念给对方听或发成文字。' },
    { id: 27, type: 'truth', stage: '心动', shortTitle: '共赏风景', title: '同一片风景', text: '如果能立刻和对方共享一处风景，你会选哪里？为什么？' },
    { id: 28, type: 'dare', stage: '心动', shortTitle: '悄悄话', title: '轻声悄悄话', text: '用你舒服的方式，轻声或打字对对方说一句只属于你们的悄悄话。' },
    { id: 29, type: 'truth', stage: '心动', shortTitle: '隔屏心动', title: '隔屏也心动', text: '对方在视频里哪种表情，或在语音里哪种语气，最让你心动？' },
    { id: 30, type: 'dare', stage: '心动', shortTitle: '同步十秒', title: '同步十秒', text: '两人在视频里同步摆动十秒；只有语音时可以一起数拍子或哼一段旋律。' },
    { id: 31, type: 'truth', stage: '心动', shortTitle: '想听肯定', title: '想听的肯定', text: '隔着距离时，你最希望对方常对你说哪句肯定的话？' },
    { id: 32, type: 'dare', stage: '心动', shortTitle: '重逢播报', title: '重逢航班播报', text: '当一次机长，用十秒播报下一次相见的目的地和你期待的瞬间。' },
    { id: 33, type: 'truth', stage: '心动', shortTitle: '小小担心', title: '愿意分享的小脆弱', text: '有没有一件你愿意让对方更理解的小担心？只分享你觉得舒服的部分。' },
    { id: 34, type: 'dare', stage: '心动', shortTitle: '搭档颁奖', title: '最佳搭档奖', text: '为对方颁发“异地最佳搭档奖”，讲一件具体的获奖事迹。' },
    { id: 35, type: 'truth', stage: '心动', shortTitle: '未来仪式', title: '未来的小仪式', text: '想和对方养成哪种不费力、又能让彼此更亲近的远程小习惯？' },
    { id: 36, type: 'dare', stage: '心动', shortTitle: '下站是你', title: '下一站是你', text: '两人轮流补完：“等我们再见面，我想和你一起……”' }
  ];

  function validatePrompts(items = prompts) {
    const errors = [];
    if (!Array.isArray(items) || items.length !== 36) {
      return { valid: false, errors: ['题库必须恰好包含 36 条。'] };
    }

    items.forEach((item, index) => {
      const expectedId = index + 1;
      const expectedType = expectedId % 2 === 1 ? 'truth' : 'dare';
      const expectedStage = expectedId <= 12 ? '破冰' : expectedId <= 24 ? '靠近' : '心动';
      if (!item || item.id !== expectedId) errors.push(`第 ${expectedId} 张卡编号错误。`);
      if (!item || item.type !== expectedType) errors.push(`第 ${expectedId} 张卡题型错误。`);
      if (!item || item.stage !== expectedStage) errors.push(`第 ${expectedId} 张卡阶段错误。`);
      if (!item || typeof item.title !== 'string' || !item.title.trim()) errors.push(`第 ${expectedId} 张卡标题为空。`);
      if (!item || typeof item.text !== 'string' || !item.text.trim()) errors.push(`第 ${expectedId} 张卡题目为空。`);
    });

    return { valid: errors.length === 0, errors };
  }

  Object.defineProperty(prompts, 'validatePrompts', {
    value: validatePrompts,
    enumerable: false
  });

  root.CoupleFlightPrompts = prompts;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = prompts;
  }
})(typeof window !== 'undefined' ? window : globalThis);

