jest.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: jest.fn().mockResolvedValue({
    url: 'http://minio/bucket',
    fields: { key: 'x', Policy: 'p', 'Content-Type': 'image/jpeg' },
  }),
}))
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/obj?sig=1'),
}))
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { MediaService } from './media.service'

describe('MediaService', () => {
  beforeEach(() => {
    ;(createPresignedPost as jest.Mock).mockClear()
    ;(getSignedUrl as jest.Mock).mockClear()
  })

  it('presignPost: key com prefixo+ext, policy com content-length-range 15MB + content-type', async () => {
    const svc = new MediaService()
    const out = await svc.presignPost('image/png', 'task')
    expect(out.key).toMatch(/^task\/[0-9a-f-]{36}\.png$/)
    expect(out.url).toBeDefined()
    expect(out.fields).toBeDefined()
    const arg = (createPresignedPost as jest.Mock).mock.calls[0][1]
    expect(arg.Conditions).toContainEqual(['content-length-range', 1, 15 * 1024 * 1024])
    expect(arg.Conditions).toContainEqual(['eq', '$Content-Type', 'image/png'])
    expect(arg.Fields).toEqual({ 'Content-Type': 'image/png' })
  })

  it('presignPost: prefixo default reports + jpg pra content-type não-png', async () => {
    const { key } = await new MediaService().presignPost('image/jpeg')
    expect(key).toMatch(/^reports\/[0-9a-f-]{36}\.jpg$/)
  })

  it('presignGetMany assina cada key', async () => {
    const urls = await new MediaService().presignGetMany(['reports/a.jpg', 'reports/b.jpg'])
    expect(urls).toEqual(['https://signed.example/obj?sig=1', 'https://signed.example/obj?sig=1'])
    expect(getSignedUrl).toHaveBeenCalledTimes(2)
  })
})
