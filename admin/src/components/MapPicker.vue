<template>
  <ElDialog
    :model-value="visible"
    title="地图选点"
    width="760px"
    destroy-on-close
    append-to-body
    @update:model-value="(v: boolean) => emit('update:visible', v)"
    @close="destroyMap"
  >
    <div ref="mapEl" v-loading="reversing" class="map-picker-box" />
    <div class="map-picker-tip">点击地图选择上门位置，拖动图钉可微调</div>

    <div class="map-picker-footer">
      <div class="map-picker-address">
        <ElInput
          v-model="addressText"
          placeholder="上门地址（可在地图反查结果上手动修改）"
          maxlength="255"
          @input="addressTouched = true"
        />
        <div v-if="pickedLng != null && pickedLat != null" class="map-picker-coord">
          经度 {{ pickedLng }} / 纬度 {{ pickedLat }}
        </div>
      </div>
      <div class="map-picker-actions">
        <ElButton @click="emit('update:visible', false)">取消</ElButton>
        <ElButton type="primary" :disabled="pickedLng == null || pickedLat == null" @click="confirmPick">
          确定选择
        </ElButton>
      </div>
    </div>
  </ElDialog>
</template>

<script setup lang="ts">
import { ElButton, ElDialog, ElInput } from 'element-plus'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/** 瓦片地址：可替换为高德/腾讯瓦片（需 key），当前用免 key 的 OpenStreetMap */
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
/** 默认中心：中国深圳。注意 Leaflet 坐标是 [纬度, 经度] */
const DEFAULT_CENTER: [number, number] = [22.6288, 114.0578]
const DEFAULT_ZOOM = 11
/** 有坐标时的定位缩放级别 */
const FOCUS_ZOOM = 15
/** 地址反查超时（毫秒）：超时静默放弃，地址用手动输入兜底 */
const REVERSE_TIMEOUT = 6000

const props = defineProps<{
  visible: boolean
  lng: number | null
  lat: number | null
  address?: string
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  /** 确定选点，携带坐标与地址（地址为输入框最终值） */
  confirm: [payload: { lng: number; lat: number; address: string }]
}>()

const mapEl = ref<HTMLElement>()
const pickedLng = ref<number | null>(null)
const pickedLat = ref<number | null>(null)
const addressText = ref('')
/** 地址是否被手动改过：改过则不再被反查结果覆盖 */
const addressTouched = ref(false)
/** 反查请求进行中（地图容器显示 loading） */
const reversing = ref(false)

let map: L.Map | null = null
let marker: L.Marker | null = null
let initTimer = 0
let reverseCtrl: AbortController | null = null

/** 自定义 HTML 图标（divIcon），规避打包后默认 marker 图片路径 404 问题 */
const PICKER_ICON = L.divIcon({
  className: 'map-picker-marker',
  html: '<div class="map-picker-pin">📍</div>',
  iconSize: [24, 28],
  iconAnchor: [12, 28],
})

/** 初始化地图：有坐标定位到该点，否则默认深圳 */
function initMap() {
  const el = mapEl.value
  if (!el || map) return
  const hasPoint = pickedLng.value != null && pickedLat.value != null
  // Leaflet center 是 [lat, lng]，与本组件内部的 pickedLng/pickedLat 顺序相反
  const center: [number, number] = hasPoint
    ? [pickedLat.value as number, pickedLng.value as number]
    : DEFAULT_CENTER
  map = L.map(el, {
    center,
    zoom: hasPoint ? FOCUS_ZOOM : DEFAULT_ZOOM,
    zoomControl: true,
    attributionControl: true,
  })
  L.tileLayer(TILE_URL, {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(map)
  if (hasPoint) {
    setMarker(pickedLng.value as number, pickedLat.value as number)
  }
  map.on('click', (e: L.LeafletMouseEvent) => pick(e.latlng))
}

/** 放置 / 移动 marker（可拖拽） */
function setMarker(lng: number, lat: number) {
  if (!map) return
  const pos: [number, number] = [lat, lng]
  if (marker) {
    marker.setLatLng(pos)
    return
  }
  marker = L.marker(pos, { icon: PICKER_ICON, draggable: true }).addTo(map)
  marker.on('dragend', () => {
    const p = marker?.getLatLng()
    if (p) pick(p, false)
  })
}

/** 选点：更新坐标 → 移动 marker → 反查地址 */
function pick(latlng: L.LatLng, reverse = true) {
  pickedLng.value = Number(latlng.lng.toFixed(6))
  pickedLat.value = Number(latlng.lat.toFixed(6))
  setMarker(pickedLng.value, pickedLat.value)
  if (reverse) reverseAddress()
}

/** 调用 Nominatim 反查地址（失败/超时静默忽略，不影响选点） */
async function reverseAddress() {
  const lng = pickedLng.value
  const lat = pickedLat.value
  if (lng == null || lat == null) return
  reverseCtrl?.abort()
  const ctrl = new AbortController()
  reverseCtrl = ctrl
  const timer = window.setTimeout(() => ctrl.abort(), REVERSE_TIMEOUT)
  reversing.value = true
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=zh-CN`,
      { signal: ctrl.signal },
    )
    if (!res.ok) return
    const data = (await res.json()) as { display_name?: string }
    const name = (data.display_name || '').trim()
    // 仅在仍是最新一次反查、且用户未手动改地址时回填
    if (name && ctrl === reverseCtrl && !addressTouched.value && lng === pickedLng.value && lat === pickedLat.value) {
      addressText.value = name
    }
  } catch {
    // 反查失败/超时：静默处理，地址沿用手动输入值
  } finally {
    window.clearTimeout(timer)
    if (ctrl === reverseCtrl) {
      reversing.value = false
      reverseCtrl = null
      // 反查拿不到结果时的兜底：用坐标生成可编辑占位地址，保证离线/内网也能走完流程
      if (!addressText.value.trim() && !addressTouched.value
        && lng === pickedLng.value && lat === pickedLat.value) {
        addressText.value = `地图选点（${lng.toFixed(4)}, ${lat.toFixed(4)}），请补充详细地址`
      }
    }
  }
}

/** 确定选择：回传坐标与地址 */
function confirmPick() {
  const lng = pickedLng.value
  const lat = pickedLat.value
  if (lng == null || lat == null) return
  emit('confirm', { lng, lat, address: addressText.value.trim() })
  emit('update:visible', false)
}

/** 销毁地图实例（关闭 / 组件卸载时调用） */
function destroyMap() {
  if (initTimer) {
    window.clearTimeout(initTimer)
    initTimer = 0
  }
  reverseCtrl?.abort()
  reverseCtrl = null
  reversing.value = false
  if (map) {
    map.remove()
    map = null
    marker = null
  }
}

// 打开时重置状态并初始化地图；leaflet 在隐藏容器里初始化会尺寸错乱，故延迟到弹窗挂载后
watch(
  () => props.visible,
  async (visible) => {
    if (!visible) {
      destroyMap()
      return
    }
    await openFlow()
  },
)

/** 弹窗打开流程：重置状态 → 等挂载 → 初始化地图 → 校正尺寸 */
async function openFlow() {
  pickedLng.value = typeof props.lng === 'number' ? props.lng : null
  pickedLat.value = typeof props.lat === 'number' ? props.lat : null
  addressText.value = props.address ?? ''
  addressTouched.value = false
  destroyMap()
  await nextTick()
  initMap()
  // 弹窗动画结束后校正尺寸
  initTimer = window.setTimeout(() => map?.invalidateSize(), 100)
}

// HMR/热重载等场景下组件重挂载但 visible 已为 true，watch 不再触发，这里兜底
onMounted(() => {
  if (props.visible) void openFlow()
})

onBeforeUnmount(destroyMap)
</script>

<style scoped>
.map-picker-box {
  height: 420px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  overflow: hidden;
  background: #f5f7fa;
}

.map-picker-tip {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}

.map-picker-footer {
  margin-top: 10px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.map-picker-address {
  flex: 1;
  min-width: 0;
}

.map-picker-coord {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}

.map-picker-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

/* 自定义图钉（divIcon 内部元素由 leaflet 注入，需用 :deep 命中） */
.map-picker-marker {
  background: transparent;
  border: none;
}

.map-picker-pin {
  font-size: 24px;
  line-height: 28px;
  text-align: center;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35));
}
</style>
