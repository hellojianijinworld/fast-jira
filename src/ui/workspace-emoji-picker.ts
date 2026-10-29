import { Picker } from "emoji-picker-element";
import dataSource from "emoji-picker-element-data/ko/cldr-native/data.json?url";

/** 이 모듈과 데이터 URL은 선택기를 처음 열 때만 불러온다. */
export function createEmojiPicker(choose: (emoji: string) => void): Picker {
  const picker = new Picker({
    locale: "ko",
    dataSource,
    i18n: {
      categoriesLabel: "카테고리",
      emojiUnsupportedMessage: "이 브라우저는 컬러 이모지를 지원하지 않아요.",
      favoritesLabel: "최근 사용",
      loadingMessage: "이모지를 불러오고 있어요…",
      networkErrorMessage: "이모지를 불러오지 못했어요. 다시 열어 주세요.",
      regionLabel: "이모지 선택",
      searchLabel: "이모지 검색",
      searchResultsLabel: "검색 결과",
      searchDescription: "위아래 화살표로 이동하고 Enter로 선택하세요.",
      skinToneDescription: "위아래 화살표로 이동하고 Enter로 선택하세요.",
      skinToneLabel: "피부색 선택 (현재 {skinTone})",
      skinTonesLabel: "피부색",
      skinTones: ["기본", "밝게", "조금 밝게", "중간", "조금 어둡게", "어둡게"],
      categories: {
        custom: "사용자 지정",
        "smileys-emotion": "표정과 감정",
        "people-body": "사람과 신체",
        "animals-nature": "동물과 자연",
        "food-drink": "음식과 음료",
        "travel-places": "여행과 장소",
        activities: "활동",
        objects: "사물",
        symbols: "기호",
        flags: "깃발",
      },
    },
  });
  picker.addEventListener("emoji-click", (event) => {
    if (event.detail.unicode) choose(event.detail.unicode);
  });
  return picker;
}
